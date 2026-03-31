declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | Array<number>);
    tempo: string | number;
    beats: number[];
  }
}
