// Weather is derived from the in-game day clock: no timers while paused,
// no sprites, and no external textures or network requests.
import { seasonAt, precipitation, SKY_LABELS } from '../seasons.js';
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
    // Each season has its own share of clear spells, rain and storms.
    const [clear, wet]=seasonAt(day).def.skies;
    return step<clear ? 'clear' : step<wet ? 'rain' : 'storm';
}
export class WeatherSystem {
    constructor(game) {
        this.game=game;
        this.type='clear';
        // What is actually falling here: rain, or snow in winter and in Frostfell.
        this.form='clear';
        this.label=SKY_LABELS.clear;
        this.lastRenderType=null;
        this.refresh();
    }
    refresh() {
        const type=weatherAt(this.game.dayCount,this.game.dayTime,this.game.dayLength);
        this.type=type;
        const regions=this.game.regions;
        const form=precipitation(type,seasonAt(this.game.dayCount).id,regions?.current,regions?.strength ?? 1);
        this.form=form;
        this.label=SKY_LABELS[form];
        if(form===this.lastRenderType) return;
        this.lastRenderType=form;
        if(typeof document!=='undefined') {
            document.body?.classList.remove('weather-rain','weather-storm','weather-snow','weather-blizzard');
            if(form!=='clear') document.body?.classList.add('weather-'+form);
        }
        this.game.uiSystem?.updateWeatherUI?.(this.label);
    }
    update() {
        if(!this.game.paused) this.refresh();
    }
}
