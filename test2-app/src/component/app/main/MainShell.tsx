import { memo, useState } from 'react';
import { type ITab, type IGrid, type IRowId, type ISide, type IStore, type TSide,  } from './types';
import { useSelector } from 'react-redux';
import { getOrderBySideAndRowId } from '../selectors';
import { numRows, orderCollection, tabs } from './mockData';
import { and, eq, useLiveQuery } from '@tanstack/react-db';
const displayName = 'MainShell';

const isRedux =  window.location.href.includes('redux');


const Grids = memo((props: ITab) => {
  return (
    <div className='grids'>
      {props.grids.map(grid => (
        <Grid key={grid.id} gridId={grid.id} lbl={grid.lbl} />
      ))}
    </div>
  );
});

/**
 * This is the only place where it's different...
 * This is the only place where it's different...
 * This is the only place where it's different...
 * This is the only place where it's different...
 * This is the only place where it's different...
 */
const Rows = memo((props: IGrid) => {
  return (
      Array.from({ length: numRows }, (_, rowIndex) => {
        const key1 = `row-${props.gridId}-${rowIndex}-${props.lbl}-a`;
        const key2 = `row-${props.gridId}-${rowIndex}-${props.lbl}-b`;
        return (
          <div className='row' key={rowIndex}>
            <div>Row {props.gridId}|{rowIndex}</div>
            {isRedux ? (
              <>
                <RenderWithSelectorRedux gridId={props.gridId} rowId={`${props.gridId}|${rowIndex}`} lbl={props.lbl} side='a' />
                <RenderWithSelectorRedux gridId={props.gridId} rowId={`${props.gridId}|${rowIndex}`} lbl={props.lbl} side='b' />
              </>
            ) : (
              <>
                <RenderWithSelectorTanstack key={key1} gridId={props.gridId} rowId={`${props.gridId}|${rowIndex}`} lbl={props.lbl} side='a' />
                <RenderWithSelectorTanstack key={key2} gridId={props.gridId} rowId={`${props.gridId}|${rowIndex}`} lbl={props.lbl} side='b' />
              </>
            )}
          </div>
        );
      })
  );
});

export const useOrderQuery = (rowId: string, side: TSide) => {
  return useLiveQuery(q =>
    q
      .from({ item: orderCollection })
      .where(({ item }) => and(
        eq(item.rowId, rowId),
        eq(item.side, side)
      )), [rowId, side]
  );
};

// Tanstack - 63ms avg
const RenderWithSelectorTanstack = memo((props: IGrid & IRowId & ISide) => {
  const order = useOrderQuery(props.rowId, props.side);
  return (
    //@ts-ignore
      <div className='side'>{order?.data?.[0]?.a}/{order?.data?.[0]?.b}</div>
  );
});

// Redux - 32ms avg
const RenderWithSelectorRedux = memo((props: IGrid & IRowId & ISide) => {
  const order = useSelector((state:IStore) => getOrderBySideAndRowId(state, props));
  return (
      <div className='side'>{order?.a}/{order?.b}</div>
  );
});

/**
 * End this is the only place where it's different...
 * End this is the only place where it's different...
 * End this is the only place where it's different...
 * End this is the only place where it's different...
 * End this is the only place where it's different...
 */

const Grid = memo((props: IGrid) => {
  return (
    <div>
      Grid {props.lbl}
      <div className='grid'>
      <Rows gridId={props.gridId} lbl={props.lbl} /></div>
    </div>
  );
});

function MainShell() {

  const [activeTab, setActiveTab] = useState<number>(0);

  const tab = tabs[activeTab];
  return (
    <div><b>Version: {isRedux ? 'Redux' : 'Tanstack'}</b> {isRedux ? <a href="/">Switch to Tanstack</a> : <a href="/?redux">Switch to Redux</a>}
      <div className='tabs'>{tabs.map(tab => <div key={tab.tabId} onClick={() => setActiveTab(tab.tabId)}>Tab {tab.tabId}</div>)}</div>
        <Grids
          key={tab.tabId}
          grids={tab.grids}
          tabId={tab.tabId}
        />
    </div>
  );
}

MainShell.displayName = displayName;

export default memo(MainShell);
