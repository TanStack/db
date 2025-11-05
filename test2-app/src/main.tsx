import ReactDOM from 'react-dom/client';
import Application from './Application';
import { buildConfig, configureStore } from './store/store';

const Index = () => {
  const storeConfig = buildConfig();
  let store = window.opener?.store;

  if (!store) {
    store = configureStore(storeConfig);
  }

  Reflect.defineProperty(window, 'store', {
    value: store,
    writable: false,
  });
  return (
      <Application store={Reflect.get(window, 'store')} />
  );
};

Index.displayName = 'Index';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <Index />
);
