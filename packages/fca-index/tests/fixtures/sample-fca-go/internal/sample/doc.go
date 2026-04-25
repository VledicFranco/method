// Package sample is the public surface of the sample Go component.
//
// It exposes SessionPort and a default constructor.
package sample

type SessionPort interface {
	Open() error
}

func New() SessionPort {
	return &session{}
}
