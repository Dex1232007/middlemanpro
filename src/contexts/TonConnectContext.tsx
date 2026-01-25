import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { ReactNode } from 'react';

// Manifest for TON Connect
const manifestUrl = 'https://middlemanpro.lovable.app/tonconnect-manifest.json';

interface TonConnectProviderProps {
  children: ReactNode;
}

export function TonConnectProvider({ children }: TonConnectProviderProps) {
  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      {children}
    </TonConnectUIProvider>
  );
}
