import { combineReducers } from 'redux';
import { ordersReducer as orders } from './orders/orders.reducer';

const createRootReducer = () =>
  // @ts-ignore
  combineReducers({
    orders,
  });

export default createRootReducer;
