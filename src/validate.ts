export const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function validName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && NAME_RE.test(name) && name !== '.' && name !== '..';
}
