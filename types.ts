
export enum OrderMode {
  HOME = 'home',
  CITY = 'city',
}

export type Language = 'en' | 'ar';

export interface OrderDetails {
  mode: OrderMode;
  photos: File[];
  size: number;
  price: number;
  comment: string;
}
