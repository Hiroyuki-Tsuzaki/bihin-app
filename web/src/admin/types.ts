export interface Item {
  id: number;
  name: string;
  unit: string;
  image_path: string | null;
  stock: number;
  threshold: number;
  unit_price: number;
  account_title_id: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface AccountTitle {
  id: number;
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Employee {
  id: number;
  employee_no: string;
  name: string;
  email: string | null;
  is_active: boolean;
}
