export type AvailabilityStatus = 'available' | 'pending' | 'archived';

export const availabilityStatusOptions: ReadonlyArray<{
  value: AvailabilityStatus;
  label: string;
}> = [
  { value: 'available', label: 'Available — customers can add it' },
  { value: 'pending', label: 'Pending — visible but unavailable' },
  { value: 'archived', label: 'Archived — hidden from customers' },
];

export function normalizeAvailabilityStatus(value: unknown): AvailabilityStatus {
  const status = String(value ?? '').trim().toLowerCase();
  return status === 'pending' || status === 'archived' ? status : 'available';
}

export function isAvailableStatus(value: unknown) {
  return normalizeAvailabilityStatus(value) === 'available';
}
