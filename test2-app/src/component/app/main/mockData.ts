import { createCollection, localOnlyCollectionOptions } from '@tanstack/react-db';
import { QueryClient } from '@tanstack/react-query';

import { type IStore, type ITab } from './types';

export const queryClient = new QueryClient();
export const KEY_SEPARATOR = '|' as const;
export const numRows = 10 as const;

const createFakeOrders = (gridId: number, index: number) => {
  const rowId = `${gridId}|${index}`;
  return {
    a: {
      gridId,
      rowId,
      id: `${rowId}|a`,
      a: gridId + 1,
      b: (gridId + 1) * 10,
      side: 'a',
    },
    b: {
      gridId,
      rowId,
      id: `${rowId}|b`,
      a: gridId + 2,
      b: (gridId + 2) * 10,
      side: 'b',
    },
  };
};

const createFakeReduxRowOrders = (gridId: number) => {
  return new Array(numRows).fill(null).reduce((acc, _, index) => {
    const rowId = `${gridId}|${index}`;
    const row = createFakeOrders(gridId, index);
    acc[rowId] = row;
    return acc;
  }, {});
};
const createFakeRowOrders = (gridId: number) => {
  return new Array(numRows).fill(null).map((_, index) => {
    return createFakeOrders(gridId, index);
  });
};

const createFakeReduxGridOrders = (gridId: number) => ({
  rows: createFakeReduxRowOrders(gridId),
});

const createFakeGridOrders = (gridId: number) => createFakeRowOrders(gridId);

export const tabs: ITab[] = [
  {
    tabId: 0,
    grids: [
      { id: 0, lbl: 'A' },
      { id: 1, lbl: 'B' },
      { id: 2, lbl: 'C' },
      { id: 3, lbl: 'D' },
      { id: 4, lbl: 'E' },
      { id: 5, lbl: 'F' },
      { id: 6, lbl: 'G' },
      { id: 7, lbl: 'H' },
      { id: 8, lbl: 'I' },
      { id: 9, lbl: 'J' },
      { id: 10, lbl: 'K' },
      { id: 11, lbl: 'L' },
    ],
  },
  {
    tabId: 1,
    grids: [
      { id: 12, lbl: 'M' },
      { id: 13, lbl: 'N' },
      { id: 14, lbl: 'O' },
      { id: 15, lbl: 'P' },
      { id: 16, lbl: 'Q' },
      { id: 17, lbl: 'R' },
      { id: 18, lbl: 'S' },
      { id: 19, lbl: 'T' },
      { id: 20, lbl: 'U' },
      { id: 21, lbl: 'V' },
      { id: 22, lbl: 'W' },
      { id: 23, lbl: 'X' },
    ],
  },
];

export const initialState: IStore = {
  orders: {
    '0': createFakeReduxGridOrders(0),
    '1': createFakeReduxGridOrders(1),
    '2': createFakeReduxGridOrders(2),
    '3': createFakeReduxGridOrders(3),
    '4': createFakeReduxGridOrders(4),
    '5': createFakeReduxGridOrders(5),
    '6': createFakeReduxGridOrders(6),
    '7': createFakeReduxGridOrders(7),
    '8': createFakeReduxGridOrders(8),
    '9': createFakeReduxGridOrders(9),
    '10': createFakeReduxGridOrders(10),
    '11': createFakeReduxGridOrders(11),
    '12': createFakeReduxGridOrders(12),
    '13': createFakeReduxGridOrders(13),
    '14': createFakeReduxGridOrders(14),
    '15': createFakeReduxGridOrders(15),
    '16': createFakeReduxGridOrders(16),
    '17': createFakeReduxGridOrders(17),
    '18': createFakeReduxGridOrders(18),
    '19': createFakeReduxGridOrders(19),
    '20': createFakeReduxGridOrders(20),
    '21': createFakeReduxGridOrders(21),
    '22': createFakeReduxGridOrders(22),
    '23': createFakeReduxGridOrders(23),
  },
};

export const orderCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'orders',
    // @ts-ignore
    queryKey: ['orders'],
    // @ts-ignore
    getKey: item => item.id,
    queryClient: queryClient,
    sync: true,
  })
);
// Now fill the tanstack collection
new Array(Object.keys(initialState.orders).length).fill(null).forEach((_, index) => {
  createFakeGridOrders(index).forEach(order => {
    orderCollection.insert(order.a);
    orderCollection.insert(order.b);
  });
});

// console.log(orderCollection.syncedData);
