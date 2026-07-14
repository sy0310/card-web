import { expandReceiptLineItems } from './wishlistReceiptUtils.ts';
import type { ReceiptLineItem } from './WishlistReceipt.tsx';

describe('wishlistReceiptUtils', () => {
  it('returns single item for quantity 1', () => {
    const items: ReceiptLineItem[] = [{ id: 'item-1', title: 'Card 1', price: 10, quantity: 1, imageUrl: '' }];
    const expanded = expandReceiptLineItems(items);
    expect(expanded.length).toBe(1);
    expect(expanded[0].id).toBe('item-1:unit-1');
    expect(expanded[0].quantity).toBe(1);
  });

  it('returns multiple items for quantity > 1', () => {
    const items: ReceiptLineItem[] = [{ id: 'item-2', title: 'Card 2', price: 15, quantity: 2, imageUrl: '' }];
    const expanded = expandReceiptLineItems(items);
    expect(expanded.length).toBe(2);
    expect(expanded[0].id).toBe('item-2:unit-1');
    expect(expanded[1].id).toBe('item-2:unit-2');
    expect(expanded[0].quantity).toBe(1);
    expect(expanded[1].quantity).toBe(1);
  });

  it('preserves original item properties', () => {
    const items: ReceiptLineItem[] = [{ id: 'item-3', title: 'Card 3', price: 20, quantity: 2, imageUrl: 'url', optionLabel: 'Option 1' }];
    const expanded = expandReceiptLineItems(items);
    expect(expanded[0].title).toBe('Card 3');
    expect(expanded[0].price).toBe(20);
    expect(expanded[0].imageUrl).toBe('url');
    expect(expanded[0].optionLabel).toBe('Option 1');
  });

  it('does not merge different items', () => {
    const items: ReceiptLineItem[] = [
      { id: 'item-4', title: 'Card 4', price: 10, quantity: 2, imageUrl: '' },
      { id: 'item-5', title: 'Card 5', price: 15, quantity: 1, imageUrl: '' },
    ];
    const expanded = expandReceiptLineItems(items);
    expect(expanded.length).toBe(3);
    expect(expanded[0].id).toBe('item-4:unit-1');
    expect(expanded[1].id).toBe('item-4:unit-2');
    expect(expanded[2].id).toBe('item-5:unit-1');
  });
});
