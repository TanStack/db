import * as goober from 'goober'
import { createSignal, useContext } from 'solid-js'
import { tokens } from './tokens'
import { ShadowDomTargetContext } from './contexts'
import type { Accessor } from 'solid-js'

const stylesFactory = (shadowDOMTarget?: ShadowRoot) => {
  const { colors, font, size, alpha, border } = tokens
  const { fontFamily, size: fontSize } = font
  const css = shadowDOMTarget
    ? goober.css.bind({ target: shadowDOMTarget })
    : goober.css

  return {
    devtoolsPanelContainer: css`
      direction: ltr;
      position: fixed;
      bottom: 0;
      right: 0;
      z-index: 99999;
      width: 100%;
      max-height: 90%;
      border-top: 1px solid ${colors.gray[700]};
      transform-origin: top;
    `,
    devtoolsPanelContainerVisibility: (isOpen: boolean) => {
      return css`
        visibility: ${isOpen ? 'visible' : 'hidden'};
      `
    },
    devtoolsPanelContainerResizing: (isResizing: Accessor<boolean>) => {
      if (isResizing()) {
        return css`
          transition: none;
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        `
      }

      return css`
        transition: all 0.4s ease;
      `
    },
    devtoolsPanelContainerAnimation: (isOpen: boolean, height: number) => {
      if (isOpen) {
        return css`
          pointer-events: auto;
          transform: translateY(0);
        `
      }
      return css`
        pointer-events: none;
        transform: translateY(${height}px);
      `
    },
    logo: css`
      cursor: pointer;
      display: flex;
      flex-direction: column;
      background-color: transparent;
      border: none;
      font-family: ${fontFamily.sans};
      gap: ${tokens.size[0.5]};
      padding: 0px;
      &:hover {
        opacity: 0.7;
      }
      &:focus-visible {
        outline-offset: 4px;
        border-radius: ${border.radius.xs};
        outline: 2px solid ${colors.blue[800]};
      }
    `,
    tanstackLogo: css`
      font-size: ${font.size.md};
      font-weight: ${font.weight.bold};
      line-height: ${font.lineHeight.xs};
      white-space: nowrap;
      color: ${colors.gray[300]};
    `,
    dbLogo: css`
      font-weight: ${font.weight.semibold};
      font-size: ${font.size.xs};
      background: linear-gradient(to right, rgb(249, 115, 22), rgb(194, 65, 12));
      background-clip: text;
      -webkit-background-clip: text;
      line-height: 1;
      -webkit-text-fill-color: transparent;
      white-space: nowrap;
    `,
    devtoolsPanel: css`
      display: flex;
      font-size: ${fontSize.sm};
      font-family: ${fontFamily.sans};
      background-color: ${colors.darkGray[700]};
      color: ${colors.gray[300]};

      @media (max-width: 700px) {
        flex-direction: column;
      }
      @media (max-width: 600px) {
        font-size: ${fontSize.xs};
      }
    `,
    dragHandle: css`
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 4px;
      cursor: row-resize;
      z-index: 100000;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      &:hover {
        background-color: ${colors.purple[400]}${alpha[90]};
      }
    `,
    firstContainer: css`
      flex: 1 1 500px;
      min-height: 40%;
      max-height: 100%;
      overflow: auto;
      border-right: 1px solid ${colors.gray[700]};
      display: flex;
      flex-direction: column;
    `,
    secondContainer: css`
      flex: 1 1 500px;
      min-height: 40%;
      max-height: 100%;
      overflow: auto;
      display: flex;
      flex-direction: column;
    `,
    collectionsList: css`
      overflow-y: auto;
      flex: 1;
    `,
    collectionsHeader: css`
      display: flex;
      align-items: center;
      padding: ${size[2]} ${size[2.5]};
      gap: ${size[2.5]};
      border-bottom: ${colors.darkGray[500]} 1px solid;
      align-items: center;
    `,
    mainCloseBtn: css`
      background: ${colors.darkGray[700]};
      padding: ${size[1]} ${size[2]} ${size[1]} ${size[1.5]};
      border-radius: ${border.radius.md};
      position: fixed;
      z-index: 99999;
      display: inline-flex;
      width: fit-content;
      cursor: pointer;
      appearance: none;
      border: 0;
      gap: 8px;
      align-items: center;
      border: 1px solid ${colors.gray[500]};
      font-size: ${font.size.xs};
      cursor: pointer;
      transition: all 0.25s ease-out;

      &:hover {
        background: ${colors.darkGray[500]};
      }
    `,
    mainCloseBtnPosition: (
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    ) => {
      const base = css`
        ${position === 'top-left' ? `top: ${size[2]}; left: ${size[2]};` : ''}
        ${position === 'top-right' ? `top: ${size[2]}; right: ${size[2]};` : ''}
        ${position === 'bottom-left'
          ? `bottom: ${size[2]}; left: ${size[2]};`
          : ''}
        ${position === 'bottom-right'
          ? `bottom: ${size[2]}; right: ${size[2]};`
          : ''}
      `
      return base
    },
    mainCloseBtnAnimation: (isOpen: boolean) => {
      if (!isOpen) {
        return css`
          opacity: 1;
          pointer-events: auto;
          visibility: visible;
        `
      }
      return css`
        opacity: 0;
        pointer-events: none;
        visibility: hidden;
      `
    },
    dbLogoCloseButton: css`
      font-weight: ${font.weight.semibold};
      font-size: ${font.size.xs};
      background: linear-gradient(to right, rgb(249, 115, 22), rgb(194, 65, 12));
      background-clip: text;
      -webkit-background-clip: text;
      line-height: 1;
      -webkit-text-fill-color: transparent;
      white-space: nowrap;
    `,
    mainCloseBtnDivider: css`
      width: 1px;
      background: ${tokens.colors.gray[600]};
      height: 100%;
      border-radius: 999999px;
      color: transparent;
    `,
    mainCloseBtnIconContainer: css`
      position: relative;
      width: ${size[5]};
      height: ${size[5]};
      background: linear-gradient(45deg, #06b6d4, #3b82f6);
      border-radius: 999999px;
      overflow: hidden;
    `,
    mainCloseBtnIconOuter: css`
      width: ${size[5]};
      height: ${size[5]};
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      filter: blur(3px) saturate(1.8) contrast(2);
    `,
    mainCloseBtnIconInner: css`
      width: ${size[4]};
      height: ${size[4]};
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    `,
    panelCloseBtn: css`
      position: absolute;
      cursor: pointer;
      z-index: 100001;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
      background-color: ${colors.darkGray[700]};
      &:hover {
        background-color: ${colors.darkGray[500]};
      }

      top: 0;
      right: ${size[2]};
      transform: translate(0, -100%);
      border-right: ${colors.darkGray[300]} 1px solid;
      border-left: ${colors.darkGray[300]} 1px solid;
      border-top: ${colors.darkGray[300]} 1px solid;
      border-bottom: none;
      border-radius: ${border.radius.sm} ${border.radius.sm} 0px 0px;
      padding: ${size[1]} ${size[1.5]} ${size[0.5]} ${size[1.5]};

      &::after {
        content: ' ';
        position: absolute;
        top: 100%;
        left: -${size[2.5]};
        height: ${size[1.5]};
        width: calc(100% + ${size[5]});
      }
    `,
    panelCloseBtnIcon: css`
      color: ${colors.gray[400]};
      width: ${size[2]};
      height: ${size[2]};
    `,
    collectionItem: css`
      display: flex;
      align-items: center;
      padding: ${size[2]};
      border-bottom: 1px solid ${colors.gray[700]};
      cursor: pointer;
      background-color: ${colors.darkGray[700]};
      transition: all 0.2s ease;
      
      &:hover {
        background-color: ${colors.darkGray[600]};
      }
    `,
    collectionItemActive: css`
      background-color: ${colors.darkGray[600]};
      border-left: 3px solid ${colors.blue[500]};
    `,
    collectionName: css`
      font-weight: ${font.weight.medium};
      color: ${colors.gray[200]};
      flex: 1;
    `,
    collectionStatus: css`
      font-size: ${fontSize.xs};
      padding: ${size[1]} ${size[2]};
      border-radius: ${border.radius.sm};
      font-weight: ${font.weight.medium};
      background-color: ${colors.green[900]};
      color: ${colors.green[300]};
      border: 1px solid ${colors.green[700]};
    `,
    collectionStatusError: css`
      background-color: ${colors.red[900]};
      color: ${colors.red[300]};
      border: 1px solid ${colors.red[700]};
    `,
    collectionCount: css`
      font-size: ${fontSize.xs};
      color: ${colors.gray[400]};
      margin-left: ${size[2]};
    `,
    detailsPanel: css`
      display: flex;
      flex-direction: column;
      background-color: ${colors.darkGray[700]};
      color: ${colors.gray[300]};
      width: 100%;
      overflow-y: auto;
    `,
    detailsHeader: css`
      display: flex;
      align-items: center;
      padding: ${size[2]};
      background-color: ${colors.darkGray[600]};
      border-bottom: 1px solid ${colors.gray[700]};
      font-weight: ${font.weight.semibold};
      color: ${colors.gray[200]};
      font-size: ${fontSize.sm};
    `,
    detailsContent: css`
      flex: 1;
      padding: ${size[2]};
      overflow-y: auto;
    `,
    explorerContainer: css`
      font-family: ${fontFamily.mono};
      font-size: ${fontSize.xs};
      color: ${colors.gray[300]};
      overflow-y: auto;
    `,
    row: css`
      display: flex;
      align-items: center;
      padding: ${size[2]} ${size[2.5]};
      gap: ${size[2.5]};
      border-bottom: ${colors.darkGray[500]} 1px solid;
      align-items: center;
    `,
    collectionsExplorerContainer: css`
      overflow-y: auto;
      flex: 1;
    `,
    collectionsExplorer: css`
      padding: ${size[2]};
    `,
    tabNav: css`
      display: flex;
      border-bottom: 1px solid ${colors.gray[700]};
      background: ${colors.darkGray[600]};
    `,
    tabBtn: css`
      flex: 1;
      padding: ${size[2]} ${size[3]};
      background: transparent;
      border: none;
      color: ${colors.gray[400]};
      cursor: pointer;
      font-size: ${fontSize.sm};
      font-weight: ${font.weight.medium};
      
      &:hover {
        background: ${colors.darkGray[500]};
      }
    `,
    tabBtnActive: css`
      background: ${colors.blue[500]};
      color: ${colors.white};
      
      &:hover {
        background: ${colors.blue[600]};
      }
    `,
    sidebarContent: css`
      flex: 1;
      overflow-y: auto;
    `,
    transactionsExplorer: css`
      display: flex;
      flex-direction: column;
      flex: 1;
    `,
  }
}

export function useStyles() {
  const shadowDomTarget = useContext(ShadowDomTargetContext)
  const [_styles] = createSignal(stylesFactory(shadowDomTarget as ShadowRoot | undefined))
  return _styles
} 