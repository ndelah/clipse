# Original 33-second ambient score. No samples or third-party recordings.
import math, struct, wave
from pathlib import Path
rate=44100
length=33
chords=[(146.83,220.00,293.66,369.99),(130.81,196,261.63,329.63),(164.81,246.94,329.63,392),(146.83,220,293.66,369.99)]
path=Path(__file__).parent/'public'/'original-score.wav'
with wave.open(str(path),'wb') as w:
 w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
 buffer=bytearray()
 for i in range(rate*length):
  t=i/rate; chord=chords[int(t/8)%4]; phase=t%8
  fade=min(1,t/1.5,(length-t)/2.5)
  pad=sum(math.sin(2*math.pi*f*t+0.08*math.sin(2*math.pi*.17*t)) for f in chord)/4*.15
  pulse=t%0.5; note=chord[int(t*2)%4]*2
  pluck=math.sin(2*math.pi*note*t)*math.exp(-pulse*11)*.09
  env=min(1,phase/.4,(8-phase)/.5)
  val=(pad*max(0,env)+pluck)*max(0,fade)*1.5
  left=int(max(-1,min(1,val))*32767); right=int(max(-1,min(1,val*.97))*32767)
  buffer.extend(struct.pack('<hh',left,right))
 w.writeframes(buffer)
print(path)
