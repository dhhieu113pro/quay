export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 24,
) {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}
