import { describe, expect, it } from 'vitest';
import { numberPlaceholderFailure } from '../number-placeholders';

describe('Russian blank document-number protection', () => {
  it('does not double-count a Uzbek -sonli suffix on a № blank', () => {
    const source = '№ ______________-sonli Shartnomaga';
    const translated = 'к Договору № ______________';

    expect(numberPlaceholderFailure(source, translated, 'Russian')).toBeUndefined();
  });

  it('still rejects a distinct Uzbek numbered blank that is omitted', () => {
    const source = '___-sonli ilova. № ______________-sonli Shartnomaga';
    const translated = 'Приложение. к Договору № ______________';

    expect(numberPlaceholderFailure(source, translated, 'Russian')).toBeTruthy();
  });

  it('accepts a distinct Uzbek numbered blank translated as a Russian blank', () => {
    const source = '___-sonli ilova. № ______________-sonli Shartnomaga';
    const translated = 'Приложение № ___. к Договору № ______________';

    expect(numberPlaceholderFailure(source, translated, 'Russian')).toBeUndefined();
  });
});
