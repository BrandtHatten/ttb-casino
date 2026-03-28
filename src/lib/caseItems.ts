export const CASE_ITEMS = [
  { multiplier: 0, weight: 10, color: '#475569', name: 'Empty' },
  { multiplier: 0.25, weight: 56.7, color: '#94a3b8', name: 'Common' },
  { multiplier: 1, weight: 20, color: '#3b82f6', name: 'Uncommon' },
  { multiplier: 2, weight: 8, color: '#8b5cf6', name: 'Rare' },
  { multiplier: 5, weight: 4, color: '#ec4899', name: 'Epic' },
  { multiplier: 10, weight: 1, color: '#ef4444', name: 'Legendary' },
  { multiplier: 50, weight: 0.25, color: '#eab308', name: 'Mythic' },
  { multiplier: 100, weight: 0.05, color: '#06b6d4', name: 'Exotic' }
];

export const rollItem = () => {
  const totalWeight = CASE_ITEMS.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of CASE_ITEMS) {
    if (random < item.weight) return item;
    random -= item.weight;
  }
  return CASE_ITEMS[0];
};
