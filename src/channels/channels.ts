export const CHANNEL_NAME_MAXIMUM_LENGTH = 120;
export const CHANNEL_SLUG_MAXIMUM_LENGTH = 80;

export interface Channel {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
