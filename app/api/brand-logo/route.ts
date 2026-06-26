import { NextRequest } from 'next/server';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const LOCAL_BRANDS_DIR = process.env.CAR_BRANDS_DIR || 'C:\\Users\\ollie\\Downloads\\Car Brands';
const PUBLIC_BRANDS_DIR = path.join(process.cwd(), 'public', 'car-brands');
const DEFAULT_FILE = 'Default.webp';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

let fileIndexCache: Record<string, string> | null = null;

function normalizeKey(input: string) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveBrandsDir() {
  if (existsSync(LOCAL_BRANDS_DIR)) return LOCAL_BRANDS_DIR;
  if (existsSync(PUBLIC_BRANDS_DIR)) return PUBLIC_BRANDS_DIR;
  return null;
}

function getFileIndex(brandsDir: string) {
  if (fileIndexCache) return fileIndexCache;

  const index: Record<string, string> = {};
  const files = readdirSync(brandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const fileName of files) {
    const ext = path.extname(fileName).toLowerCase();
    if (!CONTENT_TYPES[ext]) continue;
    const key = normalizeKey(path.basename(fileName, ext));
    if (!key) continue;
    if (!(key in index)) index[key] = fileName;
  }

  fileIndexCache = index;
  return index;
}

function findBrandFileName(index: Record<string, string>, make: string) {
  const normalizedMake = normalizeKey(make);
  if (!normalizedMake) return DEFAULT_FILE;
  return index[normalizedMake] || DEFAULT_FILE;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const make = searchParams.get('make') || '';

  const brandsDir = resolveBrandsDir();
  if (!brandsDir) {
    return new Response('Brand logo directory not found', { status: 404 });
  }

  try {
    const index = getFileIndex(brandsDir);
    const fileName = findBrandFileName(index, make);
    const filePath = path.join(brandsDir, fileName);

    if (!existsSync(filePath)) {
      return new Response('Brand logo not found', { status: 404 });
    }

    const ext = path.extname(fileName).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const body = readFileSync(filePath);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[brand-logo] failed to serve logo', err);
    return new Response('Failed to load brand logo', { status: 500 });
  }
}
