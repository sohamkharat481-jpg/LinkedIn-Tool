export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutHandle: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), ms);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}
