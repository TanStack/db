import createCachedSelector from 're-reselect';

import { KEY_SEPARATOR } from './main/mockData';
import type { IGrid, IRowId, ISide, IStore } from './main/types';

const getKeyRowAndSide = (_: IStore, props: IRowId & ISide) =>
  `${props.rowId}${KEY_SEPARATOR}${props.side}`;
const getRowProp = (_: IStore, props: IRowId) => props.rowId;
const getSideProp = (_: IStore, props: IRowId & ISide) => props.side;

const getOrdersByGrid = (state: IStore, props: IGrid & IRowId) => {
  return state.orders[props.gridId]?.rows ?? null;
};

const getOrdersByRowId = createCachedSelector(getOrdersByGrid, getRowProp, (orders, rowId) => {
  return orders[rowId] ?? null;
})(getRowProp);

export const getOrderBySideAndRowId = createCachedSelector(
  getOrdersByRowId,
  getSideProp,
  (rowOrders, side) => {
    return rowOrders?.[side] ?? null;
  }
)(getKeyRowAndSide);
