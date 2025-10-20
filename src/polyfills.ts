// Polyfill for Promise.withResolvers()
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers

// TypeScript type augmentation
declare global {
    interface PromiseConstructor {
        withResolvers<T>(): {
            promise: Promise<T>;
            resolve: (value: T | PromiseLike<T>) => void;
            reject: (reason?: any) => void;
        };
    }
}

if (!Promise.withResolvers) {
    Promise.withResolvers = function <T>() {
        let resolve: (value: T | PromiseLike<T>) => void;
        let reject: (reason?: any) => void;
        
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        
        return { promise, resolve: resolve!, reject: reject! };
    };
}

export {};
