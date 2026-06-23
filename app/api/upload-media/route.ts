import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import sharp from 'sharp';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const RESIZE_STEPS = [1920, 1600, 1280, 1024, 800, 640];
const QUALITY_STEPS = [82, 72, 64, 56, 48, 40];

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1265560829965454';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

function toJpegName(fileName: string) {
  const base = (fileName || 'image').replace(/\.[a-zA-Z0-9]+$/, '');
  return `${base}.jpg`;
}

async function compressToMax2Mb(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length <= MAX_UPLOAD_BYTES) {
    return {
      buffer: input,
      mimeType: file.type || 'image/jpeg',
      fileName: file.name || 'image.jpg',
      resized: false,
      compressed: false,
    };
  }

  let bestBuffer = Buffer.from(input);
  let bestMimeType = file.type || 'image/jpeg';
  let bestFileName = file.name || 'image.jpg';
  let bestResize = false;
  let bestQuality = 100;

  for (const maxDimension of RESIZE_STEPS) {
    for (const quality of QUALITY_STEPS) {
      try {
        const output = Buffer.from(
          await sharp(input, { failOn: 'none' })
            .rotate()
            .resize({
              width: maxDimension,
              height: maxDimension,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({
              quality,
              mozjpeg: true,
              chromaSubsampling: '4:2:0',
            })
            .toBuffer()
        );

        if (output.length < bestBuffer.length) {
          bestBuffer = output;
          bestMimeType = 'image/jpeg';
          bestFileName = toJpegName(file.name || 'image.jpg');
          bestResize = true;
          bestQuality = quality;
        }

        if (output.length <= MAX_UPLOAD_BYTES) {
          return {
            buffer: output,
            mimeType: 'image/jpeg',
            fileName: toJpegName(file.name || 'image.jpg'),
            resized: true,
            compressed: true,
            quality,
          };
        }
      } catch (err) {
        console.error('[upload-media] sharp compression iteration failed', {
          fileName: file.name,
          mimeType: file.type,
          maxDimension,
          quality,
          error: err,
        });
      }
    }
  }

  return {
    buffer: bestBuffer,
    mimeType: bestMimeType,
    fileName: bestFileName,
    resized: bestResize,
    compressed: bestBuffer.length < input.length,
    quality: bestQuality,
  };
}

export async function POST(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error('[upload-media] missing WHATSAPP_ACCESS_TOKEN/WHATSAPP_TOKEN');
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_TOKEN' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error('[upload-media] failed to parse multipart form data', err);
    return NextResponse.json({ error: 'invalid multipart form data' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    console.error('[upload-media] missing or invalid file field', {
      receivedType: file ? typeof file : 'null',
    });
    return NextResponse.json({ error: 'missing image file' }, { status: 400 });
  }
  if (!file.type?.startsWith('image/')) {
    console.error('[upload-media] rejected non-image mime type', {
      mimeType: file.type,
      fileName: file.name,
    });
    return NextResponse.json({ error: 'file must be an image' }, { status: 400 });
  }

  const originalSize = file.size;
  const processed = await compressToMax2Mb(file);
  const processedSize = processed.buffer.length;
  const uploadFile = new File([processed.buffer], processed.fileName, { type: processed.mimeType });

  if (processedSize > MAX_UPLOAD_BYTES) {
    console.error('[upload-media] image still above 2MB after compression', {
      fileName: file.name,
      originalSize,
      processedSize,
      mimeType: file.type,
    });
  }

  const waFormData = new FormData();
  waFormData.set('messaging_product', 'whatsapp');
  waFormData.set('file', uploadFile, processed.fileName || 'image.jpg');
  waFormData.set('type', processed.mimeType || 'image/jpeg');

  let upstream: Response;
  try {
    upstream = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: waFormData,
    });
  } catch (err) {
    console.error('[upload-media] network error calling Meta media API', err);
    return NextResponse.json({ error: 'network error calling media API' }, { status: 502 });
  }

  const rawText = await upstream.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    console.error('[upload-media] Meta media upload failed', {
      status: upstream.status,
      statusText: upstream.statusText,
      responseBody: rawText,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      uploadedFileName: processed.fileName,
      uploadedMimeType: processed.mimeType,
      uploadedFileSize: processedSize,
      compressionApplied: processed.compressed,
      resizeApplied: processed.resized,
      compressionQuality: processed.quality ?? null,
    });
    return NextResponse.json(
      {
        error: 'upload failed',
        details: data || rawText,
        upstream_status: upstream.status,
      },
      { status: upstream.status || 502 }
    );
  }

  console.info('[upload-media] Meta media upload success', {
    mediaId: data?.id || null,
    mimeType: file.type,
    fileName: file.name,
    fileSize: file.size,
    uploadedFileName: processed.fileName,
    uploadedMimeType: processed.mimeType,
    uploadedFileSize: processedSize,
    compressionApplied: processed.compressed,
    resizeApplied: processed.resized,
    compressionQuality: processed.quality ?? null,
  });

  return NextResponse.json({ media_id: data?.id || null, raw: data }, { status: 200 });
}
