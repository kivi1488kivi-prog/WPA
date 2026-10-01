import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn class combiner (Tailwind classes are backed by Astryx tokens). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
