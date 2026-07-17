/** Movement promoted to the first visible library group when it matches. */
export const FEATURED_LIBRARY_MOVEMENT_ID = "jumping-jacks";

/** Keep filtering stable while promoting the featured launch movement. */
export function prioritizeFeaturedMovement<T extends { id: string }>(
  movements: readonly T[],
): T[] {
  const featured: T[] = [];
  const remaining: T[] = [];
  for (const movement of movements) {
    (movement.id === FEATURED_LIBRARY_MOVEMENT_ID ? featured : remaining).push(movement);
  }
  return [...featured, ...remaining];
}
