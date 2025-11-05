import { Store } from 'redux';
import { Provider } from 'react-redux';

import './Application.scss';
import MainShell from './component/app/main/MainShell';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './component/app/main/mockData';

const displayName = 'Application';

interface IProps {
  store: Store;
}

const Application = ({ store }: IProps) => {
  return (
    <QueryClientProvider client={queryClient}>
    <Provider store={store}>
      <MainShell />
    </Provider>
    </QueryClientProvider>
  );
};
Application.displayName = displayName;

export default Application;
