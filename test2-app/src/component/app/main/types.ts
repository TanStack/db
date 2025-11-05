export interface ITab {
  tabId: number;
  grids: Array<{ id: number; lbl: string }>;
}
export interface IGrid {
  gridId: number;
  lbl: string;
}

export interface IGrid {
  gridId: number;
  lbl: string;
}

export interface IRowId {
  rowId: string;
}

export interface ISide {
  side: TSide;
}

export type TOrders = Record<
  string,
  {
    rows: {
      [key: string]: {
        a: TOrder;
        b: TOrder;
        side: TSide;
      };
    };
  }
>;
export type TOrder = {
  id: string;
  a: number;
  b: number;
  gridId: number;
  rowId: string;
};
export type TSide = 'a' | 'b';
export type TSideObj = {
  [key: string]: TOrder;
};

export interface IStore {
  orders: TOrders;
}
