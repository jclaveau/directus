import type { JsonValue } from '@directus/types';
import { promises as fs } from 'fs';
import { dirname } from 'path';

export const dumpJsonFile = async (filename: string, content: any) => {
  const filePath = `./${filename}.json`
  await fs.mkdir(dirname(filePath), { recursive: true });
  let contentString: JsonValue;

  try {
    contentString = JSON.stringify(content, null, 2);
  }
  catch (e: any) {
    contentString = JSON.stringify(e, null, 2);
    console.error(e) // eslint-disable-line no-console
  }

  await fs.writeFile(filePath, contentString);
}

