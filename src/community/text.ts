export const cleanLegacyText = (value: string): string => value.toLowerCase().replace(/[^a-z0-9 ]/gu, '');

export const cleanLegacyDatetime = (value: string): string => value
  .replaceAll(' ', '_')
  .replace(/[^A-Za-z0-9_]/gu, '');
