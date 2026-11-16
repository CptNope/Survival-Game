// Weather is derived from the in-game day clock: no timers while paused,
// no sprites, and no external textures or network requests.
export const WEATHER = Object.freeze({
    clear: {label:'Clear skies',cold:0},
    rain: {label:'Rain',cold:.28},
    storm: {label:'Storm',cold:.7}
});
export function weatherAt(day, time, length=300) {
    // Every expedition opens on a dry first morning before the weather turns.
    if (day <= 1 && time < length / 2) return 'clear';
    const segment=Math.floor((Math.max(1,day)-1)*length/75 + Math.max(0,time)/75);
    const step=((segment * 1103515245 + 12345)>>>0) % 7;
    return step<=2 ? 'clear' : step<=4 ? 'rain' : 'storm';
}
export class WeatherSystem {
    constructor(game) {
        this.game=game;
        this.type='clear';
        this.lastRenderType=null;
        this.refresh();
    }
    refresh() {
        const type=weatherAt(this.game.dayCount,this.game.dayTime,this.game.dayLength);
        this.type=type;
        if(type===this.lastRenderType) return;
        this.lastRenderType=type;
        if(typeof document!=='undefined') {
            document.body?.classList.remove('weather-rain','weather-storm');
            if(type!=='clear') document.body?.classList.add('weather-'+type);
        }
        this.game.uiSystem?.updateWeatherUI?.(WEATHER[type].label);
    }
    update() {
        if(!this.game.paused) this.refresh();
    }
}
