'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface FilterContextType {
  timePeriod: string;
  setTimePeriod: (value: string) => void;
  channel: string;
  setChannel: (value: string) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [timePeriod, setTimePeriod] = useState('6months');
  const [channel, setChannel] = useState('all');

  return (
    <FilterContext.Provider value={{ timePeriod, setTimePeriod, channel, setChannel }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
}
