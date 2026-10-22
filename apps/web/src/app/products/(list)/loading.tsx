export default function ProductsLoading() {
  return (
    <div role="status" aria-label="Loading products" className="grid animate-pulse grid-cols-1 gap-4 min-[380px]:grid-cols-2 min-[640px]:grid-cols-3 min-[900px]:grid-cols-4 min-[1150px]:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 p-4">
          <div className="mx-auto aspect-square w-[140px] rounded bg-slate-100 sm:w-[170px]" />
          <div className="h-4 rounded bg-slate-100" />
          <div className="h-4 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
