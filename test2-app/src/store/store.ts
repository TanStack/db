import createRootReducer from './configureStore';
import { initialState } from '../component/app/main/mockData';

import { applyMiddleware, createStore, StoreEnhancer } from 'redux';
import { composeWithDevTools } from '@redux-devtools/extension';

import { type IStore } from '../component/app/main/types';

const buildConfig = () => {
  const rootReducer = createRootReducer();

  return {
    rootReducer,
    initialState,
  };
};

const configureStore = ({
  rootReducer,
  initialState,
}: {
  rootReducer: ReturnType<typeof createRootReducer>;
  initialState: IStore;
}) => {
  const composeEnhancers = composeWithDevTools({});
  const useRedux = new URLSearchParams(window.location.search).has('redux');
  // Only turn on redux debug mode in localhost settings
  const enhancer: StoreEnhancer = useRedux
    ? composeEnhancers(applyMiddleware())
    : applyMiddleware();

  const store = createStore(rootReducer, initialState, enhancer);

  return store;
};

export { configureStore, buildConfig };
