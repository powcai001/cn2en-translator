declare module 'react' {
  export type KeyboardEvent<T = Element> = {
    key: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
    currentTarget: T
    preventDefault(): void
    stopPropagation(): void
  }

  export function useState<S>(initialState: S | (() => S)): [S, (value: S | ((prevState: S) => S)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useRef<T>(initialValue: T): { current: T }

  export const StrictMode: any

  const React: {
    StrictMode: any
  }

  export default React
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: any): void
  }

  const ReactDOM: {
    createRoot: typeof createRoot
  }

  export default ReactDOM
}

declare module 'react/jsx-runtime' {
  export const Fragment: any
  export function jsx(type: any, props: any, key?: any): any
  export function jsxs(type: any, props: any, key?: any): any
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any
  }
}
