package sample

import "testing"

func TestSessionOpens(t *testing.T) {
	s := New()
	if err := s.Open(); err != nil {
		t.Fatalf("open returned error: %v", err)
	}
}
