import React, { createContext, useContext } from 'react';

interface GeneralConfig {
  latitude: number;
  longitude: number;
}

const GeneralConfigContext = createContext<{ generalConfig: GeneralConfig }>({
  generalConfig: { latitude: 0, longitude: 0 }
});

export const GeneralConfigProvider: React.FC<{ value: GeneralConfig; children: React.ReactNode }> = ({ value, children }) => {
  return <GeneralConfigContext.Provider value={{ generalConfig: value }}>{children}</GeneralConfigContext.Provider>;
};

export const useGeneralConfig = () => useContext(GeneralConfigContext);
