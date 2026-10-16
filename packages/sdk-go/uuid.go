package footprint

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

var uuidState struct {
	sync.Mutex
	lastMs  int64
	counter uint16
}

// newUUIDv7 returns an RFC 9562 UUIDv7: a 48-bit Unix millisecond timestamp, version 7, a 12-bit
// counter in rand_a (monotonic within one millisecond), variant 10 and 62 random bits. When the
// counter overflows the timestamp moves on by 1 ms so ordering holds, as in the Node SDK.
func newUUIDv7(now time.Time) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	ms := now.UnixMilli()

	uuidState.Lock()
	if ms > uuidState.lastMs {
		uuidState.lastMs = ms
		// Random start with the top bit clear, which leaves room for increments.
		uuidState.counter = (uint16(b[6])<<8 | uint16(b[7])) & 0x7ff
	} else {
		uuidState.counter++
		if uuidState.counter > 0xfff {
			uuidState.lastMs++
			uuidState.counter = 0
		}
	}
	ms, counter := uuidState.lastMs, uuidState.counter
	uuidState.Unlock()

	for i := 5; i >= 0; i-- {
		b[i] = byte(ms)
		ms >>= 8
	}
	b[6] = 0x70 | byte(counter>>8)
	b[7] = byte(counter)
	b[8] = 0x80 | (b[8] & 0x3f)

	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:], b[10:])
	return string(out[:])
}
