import { pathToFileURL } from 'node:url';

export const filePathToAppUrl = (filePath: string) => {
  return `app://gptweb.ru${pathToFileURL(filePath).pathname}`;
};
