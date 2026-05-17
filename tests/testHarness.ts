export type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

let pass = 0;
let fail = 0;

export function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log('  PASS', message);
    pass++;
    return;
  }
  console.log('  FAIL', message);
  fail++;
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message} (got ${String(actual)}, expected ${String(expected)})`);
}

export function assertIncludes(haystack: string, needle: string | RegExp, message: string): void {
  const ok = typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack);
  assert(ok, message);
}

export async function runSuite(name: string, cases: TestCase[]): Promise<void> {
  console.log(`\n${name}`);
  for (const testCase of cases) {
    try {
      await testCase.run();
    } catch (err) {
      console.log('  FAIL', `${testCase.name}: ${(err as Error)?.message ?? String(err)}`);
      fail++;
    }
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
