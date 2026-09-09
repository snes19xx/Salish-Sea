// App state shared between modules.

export type Mode = 'fly' | 'sail';
export type Weather = 'clear' | 'haze' | 'over';

export const state = { hour: 19.33, weather: 'clear' as Weather, mode: 'fly' as Mode };

/** Camera bookkeeping: camInit false snaps the current camera into place on the next frame;
 *  flyU is the flyover's position along its loop (0-1). */
export const view = { camInit: false, flyU: 0.02 };
