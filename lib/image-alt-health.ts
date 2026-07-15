export function needsAltReview(altText: string | null | undefined): boolean {
  const value = altText?.trim().toLowerCase() ?? "";
  return /\.(?:avif|gif|jpe?g|png|webp)$/.test(value) || /\bsigned\s+[\p{L}]/u.test(value);
}

export function imageAltHealth(images: Array<{ altText: string | null }>) {
  const missing = images.filter((image) => !image.altText).length;
  const needsReview = images.filter((image) => !!image.altText && needsAltReview(image.altText)).length;
  return { missing, needsReview, optimized: images.length - missing - needsReview };
}
