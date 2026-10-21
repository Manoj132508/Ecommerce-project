import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface HomeState {
  searchTerm: string;
}

const initialState: HomeState = {
  searchTerm: '',
};

const homeSlice = createSlice({
  name: 'home',
  initialState,
  reducers: {
    setSearchTerm(state, action: PayloadAction<string>) {
      state.searchTerm = action.payload;
    },
    clearSearchTerm(state) {
      state.searchTerm = '';
    },
  },
});

export const { setSearchTerm, clearSearchTerm } = homeSlice.actions;
export default homeSlice.reducer;
