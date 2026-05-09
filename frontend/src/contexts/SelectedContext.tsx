import React, { createContext, useContext } from 'react';
import type { SelectedItem } from '../types';

const SelectedContext = createContext<{ items: SelectedItem[]; setItems: (items: SelectedItem[]) => void }>({
  items: [],
  setItems: () => undefined
});

export const SelectedProvider: React.FC<{
  items: SelectedItem[];
  setItems: (items: SelectedItem[]) => void;
  children: React.ReactNode;
}> = ({ items, setItems, children }) => {
  return <SelectedContext.Provider value={{ items, setItems }}>{children}</SelectedContext.Provider>;
};

export const useSelected = () => useContext(SelectedContext);
