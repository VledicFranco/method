// session — default in-memory implementation of SessionPort.
package sample

type session struct{}

func (s *session) Open() error {
	return nil
}
