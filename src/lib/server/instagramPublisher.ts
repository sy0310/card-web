import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type InstagramPublishResult = {
  success: true;
  media_code: string;
  pk: string;
  url: string;
};

type PublishServiceJson = {
  success?: boolean;
  media_code?: unknown;
  pk?: unknown;
  url?: unknown;
  error?: unknown;
};

type InstagramPublishWithOutput = InstagramPublishResult & {
  stdout: string;
};

export function parseInstagramPublishResult(stdout: string): InstagramPublishResult | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('RESULT_JSON:')) continue;

    try {
      const parsed = JSON.parse(line.substring('RESULT_JSON:'.length));
      if (!parsed?.success || typeof parsed.url !== 'string') return null;

      return {
        success: true,
        media_code: String(parsed.media_code ?? ''),
        pk: String(parsed.pk ?? ''),
        url: parsed.url,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function previewResponseBody(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function readInstagramPublishServiceResponse(
  response: Response,
): Promise<InstagramPublishResult> {
  const contentType = response.headers.get('content-type') || 'unknown';
  const body = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `Instagram publish service returned non-JSON response (status ${response.status}, content-type ${contentType}): ${previewResponseBody(body)}`,
    );
  }

  let parsed: PublishServiceJson;
  try {
    parsed = JSON.parse(body) as PublishServiceJson;
  } catch {
    throw new Error(
      `Instagram publish service returned invalid JSON (status ${response.status}): ${previewResponseBody(body)}`,
    );
  }

  if (!response.ok || parsed.error) {
    throw new Error(String(parsed.error || `Instagram publish service failed with status ${response.status}`));
  }

  if (!parsed.success || typeof parsed.url !== 'string') {
    throw new Error('Instagram publish service response did not include a successful post URL.');
  }

  return {
    success: true,
    media_code: String(parsed.media_code ?? ''),
    pk: String(parsed.pk ?? ''),
    url: parsed.url,
  };
}

function imageExtensionFromContentType(contentType: string | null) {
  const normalized = contentType?.toLowerCase().split(';')[0].trim();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return 'jpg';
}

async function runPublishScript(scriptPath: string, imagePath: string, caption: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'python3',
      [scriptPath, imagePath, caption],
      {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 2,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message || 'Python process error'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function publishInstagramPost({
  imageUrl,
  caption,
}: {
  imageUrl: string;
  caption: string;
}): Promise<InstagramPublishWithOutput> {
  if (!imageUrl) {
    throw new Error('Missing imageUrl.');
  }
  if (!caption.trim()) {
    throw new Error('Missing Instagram caption.');
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image from URL: ${imageResponse.statusText}`);
  }

  const extension = imageExtensionFromContentType(imageResponse.headers.get('content-type'));
  const tempFilePath = path.join(os.tmpdir(), `ig-${Date.now()}-${randomUUID()}.${extension}`);

  try {
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    await fs.writeFile(tempFilePath, buffer);

    const scriptPath = path.join(process.cwd(), 'src/scripts/publish-ig.py');
    const stdout = await runPublishScript(scriptPath, tempFilePath, caption);
    const result = parseInstagramPublishResult(stdout);

    if (!result) {
      throw new Error(`Publishing script did not return success json. ${stdout}`);
    }

    return { ...result, stdout };
  } finally {
    await fs.unlink(tempFilePath).catch(() => undefined);
  }
}
