import { useAppContext } from '../context/AppContext';

export function useDateRange() {
  const {
    preset,
    setPreset,
    customDates,
    setCustomDates,
    compareEnabled,
    setCompareEnabled,
    dateRange,
    timezone,
  } = useAppContext();

  return {
    preset,
    setPreset,
    customDates,
    setCustomDates,
    compareEnabled,
    setCompareEnabled,
    dateRange,
    timezone,
  };
}
