export function getMenuItemIndex(key: string, currentIndex: number, labels: string[]) {
  if (labels.length === 0) return undefined;
  if (key === "ArrowDown") return (currentIndex + 1) % labels.length;
  if (key === "ArrowUp") return currentIndex < 0 ? labels.length - 1 : (currentIndex - 1 + labels.length) % labels.length;
  if (key === "Home") return 0;
  if (key === "End") return labels.length - 1;
  if (key.length === 1 && /\S/.test(key)) {
    for (let offset = 1; offset <= labels.length; offset++) {
      const index = (Math.max(currentIndex, 0) + offset) % labels.length;
      if (labels[index].trim().toLowerCase().startsWith(key.toLowerCase())) return index;
    }
  }
  return undefined;
}
