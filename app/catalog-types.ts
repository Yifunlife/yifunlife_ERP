export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  en: string;
  category: string;
  family: "小玩具" | "模拟设备" | "大型设备";
  price: number | null;
  priceNote: string;
  usd: number | null;
  unit: string;
  spec: string;
  brand: string;
  material: string;
  note: string;
  image: string;
};
