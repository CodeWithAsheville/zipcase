declare module 'humanparser' {
  export interface ParsedName {
    firstName?: string;
    lastName?: string;
    middleName?: string;
    salutation?: string;
    suffix?: string;
    fullName?: string;
  }

  export function parseName(name: string): ParsedName;
  export function getFullestName(name: string): string;
}