export const primaryButton = [
  'cursor-pointer rounded-[5px] border border-transparent bg-[#198754] text-sm text-white',
  'shadow-[0_2px_5px_rgba(220,220,220,0.5)] transition-colors',
  'hover:bg-[#198754]/75 active:bg-[#198754]/50 active:shadow-none',
  'disabled:cursor-not-allowed disabled:opacity-50'
].join(' ');

export const secondaryButton = [
  'cursor-pointer rounded-[5px] border border-[#c8c8c8] bg-white text-sm text-[#212121]',
  'shadow-[0_2px_5px_rgba(220,220,220,0.2)] transition-colors',
  'hover:bg-[#fafafa] active:bg-[#f0f0f0] active:shadow-none'
].join(' ');

export const selectInput = [
  'cursor-pointer rounded-[5px] border border-[#c8c8c8] bg-white px-[5px] py-[3px] text-[15px] text-[#212121]',
  'shadow-[0_1px_3px_rgba(200,200,200,0.2)] focus:outline-2 focus:outline-[#198754]'
].join(' ');

export const actionLink = [
  'cursor-pointer text-[#198754] transition-opacity hover:opacity-75 active:opacity-50'
].join(' ');
