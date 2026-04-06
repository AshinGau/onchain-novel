/** Simple class name joiner — replaces clsx+twMerge now that we use Bootstrap */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(" ");
}
