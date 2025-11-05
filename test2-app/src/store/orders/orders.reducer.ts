import { createReducer } from 'typesafe-actions';

import type { IStore } from '../../component/app/main/types';

export const handleActions = {};

export const ordersReducer = createReducer<IStore['orders']>({}, handleActions);
